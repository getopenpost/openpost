import { z } from "zod";

export const draftTransferOrigin = "https://openpo.st";
export const draftTransferTimeoutMS = 30_000;
export const draftTransferLimits = {
  parts: 100,
  partCharacters: 50_000,
  totalCharacters: 500_000,
  files: 35,
  fileBytes: 250_000_000,
  pollMinimumSeconds: 300,
  pollMaximumSeconds: 1_209_600,
} as const;
export const draftTransferSchema = z
  .object({
    version: z.literal(1),
    parts: z
      .array(z.string().max(draftTransferLimits.partCharacters))
      .min(1)
      .max(draftTransferLimits.parts),
    link: z.string().max(2048).default(""),
    poll: z
      .object({
        question: z.string().max(5000),
        options: z.array(z.string().min(1).max(1000)).min(2).max(10),
        durationSeconds: z
          .number()
          .int()
          .min(draftTransferLimits.pollMinimumSeconds)
          .max(draftTransferLimits.pollMaximumSeconds),
      })
      .optional(),
    files: z
      .array(
        z.object({
          file: z.custom<File>((value) => value instanceof File),
          alt: z.string().max(10_000),
        }),
      )
      .max(draftTransferLimits.files),
  })
  .superRefine((draft, context) => {
    if (
      draft.parts.reduce((total, part) => total + part.length, 0) >
        draftTransferLimits.totalCharacters ||
      draft.files.reduce((total, item) => total + item.file.size, 0) > draftTransferLimits.fileBytes
    ) {
      context.addIssue({ code: "custom", message: "This draft exceeds the transfer limit." });
    }
  });
export type ToolDraft = z.infer<typeof draftTransferSchema>;
export const draftTransferMessageSchema = z.object({
  type: z.literal("openpost:tool-draft"),
  token: z.uuid(),
  draft: draftTransferSchema,
});
export const draftTransferReceiptSchema = z.object({
  type: z.enum(["openpost:tool-ready", "openpost:tool-saved", "openpost:tool-error"]),
  token: z.uuid(),
});
