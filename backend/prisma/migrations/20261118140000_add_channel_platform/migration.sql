-- Add the missing social platform field to existing channels.
ALTER TABLE "Channel"
ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'youtube';
