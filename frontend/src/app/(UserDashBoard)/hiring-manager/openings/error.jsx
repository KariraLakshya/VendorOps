"use client";
import { useEffect } from "react";
import ErrorComponent from "@/components/common/ErrorComponent";

export default function HiringManagerOpeningsError({ error, reset }) {
  useEffect(() => {
    console.error("Hiring manager openings error boundary:", error);
  }, [error]);

  return (
    <ErrorComponent
      title="Couldn't load openings"
      message={error?.message || "Something went wrong while loading your openings."}
      onRetry={reset}
    />
  );
}
