"use client";
import { useEffect } from "react";
import ErrorComponent from "@/components/common/ErrorComponent";

export default function VendorOpeningsError({ error, reset }) {
  useEffect(() => {
    console.error("Vendor openings error boundary:", error);
  }, [error]);

  return (
    <ErrorComponent
      title="Couldn't load openings"
      message={error?.message || "Something went wrong while loading contract openings."}
      onRetry={reset}
    />
  );
}
