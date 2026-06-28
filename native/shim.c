/*
 * Emscripten shim around rtl-wmbus.
 *
 * rtl-wmbus is built as a CLI filter: main() reads cu8 from stdin in a loop and
 * writes telegram lines to stdout. For a streaming browser pipeline we instead
 * want to feed sample blocks incrementally and keep the demodulator state alive
 * between blocks.
 *
 * We #include rtl_wmbus.c directly (with its main() renamed out of the way) so
 * that all of its `static`/`static inline` DSP functions are visible here, then
 * re-implement the body of main()'s sample loop as two exported functions:
 *
 *   rtlwmbus_init()  - sets options to the same defaults as the CLI, resets the
 *                      demodulator algorithms and builds the frequency-translation
 *                      lookup tables.
 *   rtlwmbus_feed()  - runs a block of interleaved cu8 samples through the exact
 *                      same per-sample chain that main()'s inner loop runs.
 *
 * Telegrams are emitted by the packet decoders via fprintf(stdout, ...), exactly
 * as in the CLI. Under Emscripten stdout is line-buffered and delivered to the
 * JS `print` callback, so the worker parses telegrams from there.
 *
 * Demodulator state lives in file-scope statics here plus the static state
 * internal to the moving-average filters in rtl_wmbus.c. A single instance is
 * sufficient because there is exactly one sample stream.
 */

#include <emscripten.h>
#include <stddef.h>
#include <stdint.h>

/* Rename rtl-wmbus's main so its body compiles but never runs. */
#define main rtlwmbus_disabled_main
#include "rtl_wmbus.c"
#undef main

/* Persistent demodulator state (mirrors the locals in the original main()). */
static struct time2_algorithm_t1_c1 g_t2_algo_t1_c1;
static struct time2_algorithm_s1 g_t2_algo_s1;
static struct runlength_algorithm_t1_c1 g_rl_algo_t1_c1;
static struct runlength_algorithm_s1 g_rl_algo_s1;
static unsigned g_decimation_rate_index;

static t1_c1_signal_chain_prototype g_process_t1_c1_chain;
static s1_signal_chain_prototype g_process_s1_chain;
static float (*g_disc_t1_c1)(float i, float q);
static float (*g_disc_s1)(float i, float q);
static int g_fs_kHz;

EMSCRIPTEN_KEEPALIVE
void rtlwmbus_init(int decimation_rate, int simultaneous)
{
    /* Options otherwise match the rtl-wmbus CLI with no flags: accurate atan,
     * both T1/C1 and S1 enabled, run length + time2 algorithms enabled.
     *
     * decimation_rate maps to the CLI -d flag: sample rate = decimation * 800
     * kHz (2 => 1.6 Msps, 3 => 2.4 Msps). simultaneous maps to the -s flag,
     * which frequency-shifts so S1 and T1/C1 are received together with the SDR
     * tuned to 868.625 MHz. */
    opts_decimation_rate = decimation_rate > 0 ? (unsigned)decimation_rate : 2u;
    opts_accurate_atan = 1;
    opts_run_length_algorithm_enabled = 1;
    opts_time2_algorithm_enabled = TIME2_ALGORITHM_ENABLED;
    opts_s1_t1_c1_simultaneously = simultaneous ? 1 : 0;
    opts_remove_dc_offset = 0;
    opts_show_used_algorithm = 0;
    opts_t1_c1_processing_enabled = 1;
    opts_s1_processing_enabled = 1;

    g_fs_kHz = opts_decimation_rate * 800;

    time2_algorithm_t1_c1_reset(&g_t2_algo_t1_c1);
    time2_algorithm_s1_reset(&g_t2_algo_s1);
    runlength_algorithm_reset_t1_c1(&g_rl_algo_t1_c1);
    runlength_algorithm_reset_s1(&g_rl_algo_s1);

    g_process_t1_c1_chain = t1_c1_signal_chain;
    g_process_s1_chain = s1_signal_chain;
    g_disc_t1_c1 = polar_discriminator_t1_c1;
    g_disc_s1 = polar_discriminator_s1;

    g_decimation_rate_index = 0;

    setup_lookup_tables_for_frequency_translation(g_fs_kHz);
}

/*
 * Feed a block of interleaved cu8 samples (I0,Q0,I1,Q1,...). `len` is the number
 * of bytes (= number of samples * 2). This mirrors the inner body of main()'s
 * read loop one-for-one.
 */
EMSCRIPTEN_KEEPALIVE
void rtlwmbus_feed(const uint8_t *samples, int len)
{
    for (int k = 0; k + 1 < len; k += 2)
    {
        const float i_unfilt = ((float)(samples[k])     - 127.5f);
        const float q_unfilt = ((float)(samples[k + 1]) - 127.5f);

        float i_t1_c1_unfilt = i_unfilt;
        float q_t1_c1_unfilt = q_unfilt;
        float i_s1_unfilt = i_unfilt;
        float q_s1_unfilt = q_unfilt;

        /* In simultaneous mode the SDR is tuned to 868.625 MHz and we shift
         * T1/C1 and S1 to their respective baseband positions. */
        if (opts_s1_t1_c1_simultaneously)
        {
            shift_freq_plus_minus325(&i_t1_c1_unfilt, &q_t1_c1_unfilt,
                                     &i_s1_unfilt, &q_s1_unfilt, g_fs_kHz);
        }

        const float i_t1_c1 = moving_average_t1_c1(i_t1_c1_unfilt, 0);
        const float q_t1_c1 = moving_average_t1_c1(q_t1_c1_unfilt, 1);

        const float i_s1 = moving_average_s1(i_s1_unfilt, 0);
        const float q_s1 = moving_average_s1(q_s1_unfilt, 1);

        if (++g_decimation_rate_index < opts_decimation_rate) continue;
        g_decimation_rate_index = 0;

        g_process_t1_c1_chain(i_t1_c1, q_t1_c1, &g_t2_algo_t1_c1, &g_rl_algo_t1_c1, g_disc_t1_c1);
        g_process_s1_chain(i_s1, q_s1, &g_t2_algo_s1, &g_rl_algo_s1, g_disc_s1);
    }
}
