let uploadAttachments = null;
let downloadAttachment = null;

export function configureRemoteAttachments({ upload, download }) {
  uploadAttachments = typeof upload === "function" ? upload : null;
  downloadAttachment = typeof download === "function" ? download : null;
}

export async function uploadAttachmentsBeforePersist(attachments) {
  if (!attachments?.length) return;
  if (!uploadAttachments) {
    throw new Error("Attachments require a configured remote sync server.");
  }
  await uploadAttachments(attachments);
}

export async function downloadAttachmentOnDemand(attachment) {
  if (!attachment?.id) throw new Error("Attachment is missing its remote id.");
  if (!downloadAttachment) {
    throw new Error("Attachments require a configured remote sync server.");
  }
  return downloadAttachment(attachment);
}
