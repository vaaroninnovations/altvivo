import { UserView } from "./user-view";

export const metadata = { title: "User" };

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserView id={id} />;
}
