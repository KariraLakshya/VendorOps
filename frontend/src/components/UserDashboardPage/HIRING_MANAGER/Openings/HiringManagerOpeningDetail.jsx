"use client";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { fetchHiringManagerProfiles } from "@/redux/features/HiringManager/hiringManagerSlice";
import { Skeleton } from "@/components/UI/shadcn/skeleton";
import EmptyState from "@/components/common/EmptyState";
import ProfileCard from "./ProfileCard";

const VIRTUALIZATION_THRESHOLD = 50;
const ESTIMATED_CARD_HEIGHT = 190;

export default function HiringManagerOpeningDetail({ openingId }) {
  const dispatch = useDispatch();
  const { profiles, profilesLoading, error } = useSelector((state) => state.hiringManager);
  const parentRef = useRef(null);

  useEffect(() => {
    dispatch(fetchHiringManagerProfiles(openingId));
  }, [dispatch, openingId]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const shouldVirtualize = profiles.length > VIRTUALIZATION_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? profiles.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 8,
  });

  if (profilesLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        title="No profiles submitted yet"
        message="Once a vendor submits candidate profiles for this opening, they'll show up here with AI recommendations."
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-semibold text-foreground">
        Submitted Profiles <span className="text-muted-foreground font-normal">({profiles.length})</span>
      </h1>

      {!shouldVirtualize ? (
        <div className="space-y-4">
          {profiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} />
          ))}
        </div>
      ) : (
        <div ref={parentRef} className="h-[75vh] overflow-auto rounded-lg">
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingBottom: "1rem",
                }}
              >
                <ProfileCard profile={profiles[virtualRow.index]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
