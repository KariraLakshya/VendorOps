"use client";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "sonner";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock,
  ScanEye,
} from "lucide-react";
import { shortlistProfile, rejectProfile } from "@/redux/features/HiringManager/hiringManagerSlice";
import { Button } from "@/components/UI/shadcn/button";

const DECISION_META = {
  RECOMMENDED: {
    label: "Recommended",
    dot: "bg-green-500",
    badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  BORDERLINE: {
    label: "Borderline",
    dot: "bg-yellow-500",
    badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  NOT_RECOMMENDED: {
    label: "Not Recommended",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
};

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString();
}

function RecommendationBadge({ profile }) {
  if (profile.recommendationStatus === "PENDING" || profile.recommendationStatus === "PROCESSING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
      </span>
    );
  }

  if (profile.recommendationStatus === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        <XCircle className="h-3 w-3" /> Analysis failed
      </span>
    );
  }

  const decision = profile.recommendation?.decision;
  const meta = DECISION_META[decision];
  if (!meta) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${meta.badge}`}>
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export default function ProfileCard({ profile }) {
  const dispatch = useDispatch();
  const [pendingAction, setPendingAction] = useState(null);

  const isDecided = profile.status === "SHORTLISTED" || profile.status === "REJECTED";
  const recommendation = profile.recommendation;

  const handleShortlist = async () => {
    setPendingAction("shortlist");
    try {
      await dispatch(shortlistProfile(profile.id)).unwrap();
      toast.success("Candidate shortlisted");
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to shortlist");
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async () => {
    setPendingAction("reject");
    try {
      await dispatch(rejectProfile(profile.id)).unwrap();
      toast.success("Candidate rejected");
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to reject");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{profile.fileName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              Uploaded {formatDate(profile.submittedAt)}
              {recommendation?.usedVisionFallback && (
                <span
                  className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                  title="Extracted text was too thin (likely a scanned resume) — read via vision model instead"
                >
                  <ScanEye className="h-3 w-3" /> scanned
                </span>
              )}
            </p>
          </div>
        </div>
        <RecommendationBadge profile={profile} />
      </div>

      {recommendation && (
        <div className="grid grid-cols-3 gap-3 text-center py-2 border-y border-border">
          <div>
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="text-sm font-semibold text-foreground">
              {Math.round(recommendation.score * 100)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="text-sm font-semibold text-foreground">
              {Math.round(recommendation.confidence * 100)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" /> Processing
            </p>
            <p className="text-sm font-semibold text-foreground">{recommendation.latencyMs}ms</p>
          </div>
        </div>
      )}

      {recommendation?.reason && (
        <p className="text-sm text-muted-foreground italic">"{recommendation.reason}"</p>
      )}

      {profile.recommendationStatus === "FAILED" && profile.recommendationError && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {profile.recommendationError}
        </p>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">Status: {profile.status}</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isDecided || pendingAction !== null}
            onClick={handleReject}
          >
            {pendingAction === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
            Reject
          </Button>
          <Button
            size="sm"
            disabled={isDecided || pendingAction !== null}
            onClick={handleShortlist}
          >
            {pendingAction === "shortlist" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            Shortlist
          </Button>
        </div>
      </div>
    </div>
  );
}
