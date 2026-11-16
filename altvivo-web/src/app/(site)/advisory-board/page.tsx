import { redirect } from "next/navigation";

/** The Scientific Advisory Board now lives on the About page. */
export default function AdvisoryBoardPage() {
  redirect("/about#advisory-board");
}
