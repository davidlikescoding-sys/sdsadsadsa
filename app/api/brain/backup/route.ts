import { publicErrorMessage } from "@/lib/api-error";
import { createBackup, getBrainDb, listBackups, listLocalBackupFiles } from "@/lib/brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = getBrainDb();
    return Response.json({ ok: true, backups: listBackups(db), files: listLocalBackupFiles() });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Backup listing failed.") }, { status: 500 });
  }
}

export function POST(request: Request) {
  try {
    const reason = new URL(request.url).searchParams.get("reason") ?? "manual";
    const backup = createBackup(getBrainDb(), reason);
    return Response.json({ ok: true, backup });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error, "Backup failed.") }, { status: 500 });
  }
}
