import { coreGet } from "@/lib/server/core";
import { loadProtected, pathWithQuery, type SearchParams } from "@/lib/server/protected";
import { requireSession } from "@/lib/server/session";
import { AccountView, type AccountData } from "./security-view";

export const metadata = { title: "Account & security" };

interface MeResponse {
  profile: AccountData["profile"];
  organization: AccountData["organization"];
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await requireSession(pathWithQuery("/workspace/security", sp), sp.av_r === "1");
  const mfaRequiredForRole = session.role === "INSTITUTE_ADMIN" || session.role === "SUPERADMIN";

  // Administrator roles must enrol in TOTP before any other API is available.
  if (session.mfaEnrollmentRequired) {
    return (
      <AccountView
        data={{ email: session.email, name: session.name, role: session.role, mfaRequiredForRole: true, enrollmentPending: true, profile: null, organization: null, sessions: [] }}
      />
    );
  }
  const { data: me } = await loadProtected<MeResponse>("/workspace/security", sp, "/v1/api/me");
  const { sessions } = await coreGet<{ sessions: AccountData["sessions"] }>("/v1/api/sessions", { token: session.token });
  return (
    <AccountView
      data={{
        email: session.email,
        name: session.name,
        role: session.role,
        mfaRequiredForRole,
        enrollmentPending: false,
        profile: me.profile,
        organization: me.organization,
        sessions,
      }}
    />
  );
}
