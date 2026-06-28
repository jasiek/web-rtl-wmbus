import type { DecodeStatus } from "../worker/decoder.ts";

/** A padlock emoji + tooltip describing whether a telegram could be read. */
export type LockBadge = { emoji: string; title: string };

/**
 * Maps a decode status to a padlock badge:
 *   🔓 read (unencrypted)   🔑 decrypted with key 0x0
 *   🔒 encrypted (unread)   ❔ not decoded
 * `undefined` means the decode result has not arrived yet.
 */
export function lockBadge(status: DecodeStatus | undefined): LockBadge {
  switch (status) {
    case "decoded":
      return { emoji: "🔓", title: "Read (unencrypted)" };
    case "decoded_zero_key":
      return { emoji: "🔑", title: "Decrypted with key 0x0" };
    case "recognized":
      return { emoji: "🔓", title: "Read (recognized, no driver)" };
    case "encrypted":
      return { emoji: "🔒", title: "Encrypted — could not read with key 0x0" };
    case "undecoded":
      return { emoji: "❔", title: "Not decoded" };
    default:
      return { emoji: "⏳", title: "Decoding…" };
  }
}
