-- CreateEnum
CREATE TYPE "SlabStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'PACKED', 'DISPATCHED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SlabSource" AS ENUM ('QC_AUTOLINK', 'BULK_UPLOAD');

-- CreateTable
CREATE TABLE "fg_finished_slab" (
    "id" TEXT NOT NULL,
    "slab_number" DOUBLE PRECISION NOT NULL,
    "design" TEXT,
    "grade" TEXT,
    "slab_thickness" TEXT,
    "polish_type" TEXT,
    "rw_status" TEXT,
    "repolish_status" TEXT,
    "batch_number" TEXT,
    "batch_key" TEXT,
    "barcode" TEXT,
    "qc_inspector" TEXT,
    "last_qc_at" TIMESTAMP(3),
    "length_in" DOUBLE PRECISION DEFAULT 137,
    "width_in" DOUBLE PRECISION DEFAULT 79,
    "bay_number" TEXT,
    "frame_number" TEXT,
    "status" "SlabStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reserved_for_pi" TEXT,
    "customer" TEXT,
    "reserved_at" TIMESTAMP(3),
    "reservation_expires_at" TIMESTAMP(3),
    "notes" TEXT,
    "source" "SlabSource" NOT NULL DEFAULT 'QC_AUTOLINK',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fg_finished_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_design_alias" (
    "id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_design_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fg_slab_event" (
    "id" TEXT NOT NULL,
    "slab_number" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT,
    "source" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fg_slab_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fg_finished_slab_slab_number_key" ON "fg_finished_slab"("slab_number");

-- CreateIndex
CREATE INDEX "fg_finished_slab_batch_key_idx" ON "fg_finished_slab"("batch_key");

-- CreateIndex
CREATE INDEX "fg_finished_slab_status_idx" ON "fg_finished_slab"("status");

-- CreateIndex
CREATE INDEX "fg_finished_slab_grade_idx" ON "fg_finished_slab"("grade");

-- CreateIndex
CREATE INDEX "fg_finished_slab_design_idx" ON "fg_finished_slab"("design");

-- CreateIndex
CREATE UNIQUE INDEX "fg_design_alias_variant_key" ON "fg_design_alias"("variant");

-- CreateIndex
CREATE INDEX "fg_design_alias_canonical_idx" ON "fg_design_alias"("canonical");

-- CreateIndex
CREATE INDEX "fg_slab_event_slab_number_idx" ON "fg_slab_event"("slab_number");

-- CreateIndex
CREATE INDEX "fg_slab_event_at_idx" ON "fg_slab_event"("at");

-- AddForeignKey
ALTER TABLE "fg_slab_event" ADD CONSTRAINT "fg_slab_event_slab_number_fkey" FOREIGN KEY ("slab_number") REFERENCES "fg_finished_slab"("slab_number") ON DELETE RESTRICT ON UPDATE CASCADE;

