import { redirect } from "next/navigation";

/** Moved to /workspace/security (the address XPRISM's password pages hand off to). */
export default function AccountPage() {
  redirect("/workspace/security");
}
