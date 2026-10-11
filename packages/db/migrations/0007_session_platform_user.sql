-- Story 1.9 security review: record which platform user opened an embedded session (audit).
ALTER TABLE "merchant_sessions" ADD COLUMN "platform_user_id" text;
