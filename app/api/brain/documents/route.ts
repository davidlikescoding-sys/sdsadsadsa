import { publicErrorMessage } from "@/lib/api-error";
import { deleteDocument, importDocument } from "@/lib/brain/documents";
import { getBrainDb, listDocuments } from "@/lib/brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json({ ok: true, documents: listDocuments(getBrainDb()) });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Could not list documents.") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "Attach a file under the 'file' field." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ ok: false, error: "Files above 20 MB are not imported offline." }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const field = (name: string): string | undefined => {
      const value = form.get(name);
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    };
    const result = importDocument(getBrainDb(), file.name, buffer, {
      docVersion: field("docVersion"),
      sourceUrl: field("sourceUrl"),
      retrievedAt: field("retrievedAt") ?? new Date().toISOString(),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Could not learn from this file.") }, { status: 500 });
  }
}

export function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return Response.json({ ok: false, error: "Provide a document id." }, { status: 400 });
    return Response.json({ ok: true, deleted: deleteDocument(getBrainDb(), id) });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Could not delete the document chunk.") }, { status: 500 });
  }
}
