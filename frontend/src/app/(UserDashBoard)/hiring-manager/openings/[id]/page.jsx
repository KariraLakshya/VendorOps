import HiringManagerOpeningDetail from "@/components/UserDashboardPage/HIRING_MANAGER/Openings/HiringManagerOpeningDetail";

export default async function HiringManagerOpeningDetailPage({ params }) {
  const { id } = await params;
  return <HiringManagerOpeningDetail openingId={id} />;
}
