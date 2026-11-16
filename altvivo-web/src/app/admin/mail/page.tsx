import { Suspense } from "react";
import { MailView } from "./mail-view";

export const metadata = { title: "Mailbox" };

export default function AdminMail() {
  return (
    <Suspense>
      <MailView />
    </Suspense>
  );
}
