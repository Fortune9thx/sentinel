import { NewSignalForm } from "./NewSignalForm";

export default async function NewSignalPage({
  searchParams,
}: {
  searchParams: Promise<{ covenant?: string }>;
}) {
  const { covenant } = await searchParams;
  return <NewSignalForm initialCovenant={covenant ?? ""} />;
}
