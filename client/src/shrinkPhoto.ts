// Phone cameras produce photos of several megabytes. Labels stay readable at a
// fraction of that, so photos are scaled down on the device before upload:
// faster on mobile data, and well inside the server's size limit.

const LONGEST_SIDE = 1600;
const QUALITY = 0.85;

export async function shrinkPhoto(file: File): Promise<File> {
  try {
    // Respects the camera's rotation flag, so the label is the right way up.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // A format this browser cannot draw is sent as it is.
    return file;
  }
}
