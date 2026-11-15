import { InstitutionView } from "./institution-view";

export const metadata = { title: "Institution" };

export default async function AdminInstitution({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InstitutionView id={id} />;
}
