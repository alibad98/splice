import { z } from 'zod';
import { ConnectionStatus } from './connection.js';

/** `POST /v1/session/embedded` response: a short-lived bearer for the dashboard to keep in memory only (Story 1.9). */
export const EmbeddedSession = z.object({
  v: z.literal(1).default(1),
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  /** Seconds until the bearer expires; the dashboard asks the host for a fresh token before then. */
  expires_in: z.number().int().positive(),
  expires_at: z.iso.datetime(),
});
export type EmbeddedSession = z.infer<typeof EmbeddedSession>;

/** `GET /v1/session`: who is signed in and what the shell shows. */
export const SessionInfo = z.object({
  v: z.literal(1).default(1),
  mode: z.enum(['embedded', 'direct']),
  store: z.object({ name: z.string() }),
  connection: ConnectionStatus,
  expires_at: z.iso.datetime(),
  /** Direct-link (cookie) sessions only: send it as `x-csrf-token` on every state-changing request. */
  csrf_token: z.string().optional(),
  /** Direct-link sessions only: where to open Slips inside the platform dashboard. */
  open_in_platform_url: z.string().optional(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

/** Stable `code` values on session-related problem+json responses. */
export const SESSION_PROBLEM_CODES = ['session_required', 'session_expired', 'invalid_token', 'store_not_installed', 'csrf_invalid', 'admin_forbidden', 'platform_unavailable'] as const;
export type SessionProblemCode = (typeof SESSION_PROBLEM_CODES)[number];
