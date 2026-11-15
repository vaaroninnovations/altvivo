import { redirect } from "next/navigation";

/** The switchboard moved into the SuperAdmin panel. */
export default function LegacySwitchboard() {
  redirect("/admin/apps");
}
