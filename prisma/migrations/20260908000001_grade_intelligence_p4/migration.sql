-- Phase 4: Grade Intelligence
-- Add score fields to SyllabusItem for tracking actual grades

ALTER TABLE "SyllabusItem" ADD COLUMN "earnedPoints" REAL;
ALTER TABLE "SyllabusItem" ADD COLUMN "maxPoints" REAL;
