import { InvoicesView } from "./invoices-view";

export const metadata = { title: "Invoices" };

export default async function AdminInvoices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  return <InvoicesView initial={{ kind: one("kind"), status: one("status"), q: one("q") }} />;
}
