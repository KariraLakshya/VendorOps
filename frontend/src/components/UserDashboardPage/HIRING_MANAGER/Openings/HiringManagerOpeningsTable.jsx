"use client";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import { fetchHiringManagerOpenings } from "@/redux/features/HiringManager/hiringManagerSlice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/UI/shadcn/table";
import { Skeleton } from "@/components/UI/shadcn/skeleton";
import { Button } from "@/components/UI/shadcn/button";
import EmptyState from "@/components/common/EmptyState";

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function HiringManagerOpeningsTable() {
  const dispatch = useDispatch();
  const router = useRouter();
  const { openings, pagination, loading } = useSelector((state) => state.hiringManager);
  const [page, setPage] = useState(1);

  useEffect(() => {
    dispatch(fetchHiringManagerOpenings({ page, pageSize: 10 }));
  }, [dispatch, page]);

  return (
    <div className="w-full p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">My Openings</h1>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Contract Type</TableHead>
              <TableHead>Experience</TableHead>
              <TableHead>Posted Date</TableHead>
              <TableHead>Profiles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!loading &&
              openings.map((opening) => (
                <TableRow
                  key={opening.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/hiring-manager/openings/${opening.id}`)}
                >
                  <TableCell className="font-medium">{opening.title}</TableCell>
                  <TableCell>{opening.location || "Remote"}</TableCell>
                  <TableCell>{opening.contractType || "-"}</TableCell>
                  <TableCell>
                    {opening.experienceRange.min}
                    {opening.experienceRange.max != null ? `-${opening.experienceRange.max}` : "+"} yrs
                  </TableCell>
                  <TableCell>{formatDate(opening.postedDate)}</TableCell>
                  <TableCell>{opening.profilesCount}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {!loading && openings.length === 0 && (
          <EmptyState title="No openings yet" message="You don't have any contract openings assigned to you." />
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} openings)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
