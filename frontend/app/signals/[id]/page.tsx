import { SignalDetail } from "./SignalDetail";

export default async function SignalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ covenant?: string }>;
}) {
  const { id } = await params;
  const { covenant } = await searchParams;
  return <SignalDetail covenantAddress={covenant ?? ""} signalId={id} />;
}
