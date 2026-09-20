import VendorOpeningDetail from "@/components/UserDashboardPage/IT_VENDOR/Openings/VendorOpeningDetail";

export default async function VendorOpeningDetailPage({ params }) {
  const { id } = await params;
  return <VendorOpeningDetail openingId={id} />;
}
