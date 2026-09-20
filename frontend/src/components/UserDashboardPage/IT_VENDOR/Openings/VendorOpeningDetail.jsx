"use client";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { UploadCloud, FileText, Trash2, Loader2, Eye } from "lucide-react";
import {
  fetchVendorOpeningDetails,
  presignProfiles,
  uploadProfiles,
  deleteVendorProfile,
} from "@/redux/features/Vendor/vendorOpeningsSlice";
import { Skeleton } from "@/components/UI/shadcn/skeleton";
import { Button } from "@/components/UI/shadcn/button";
import EmptyState from "@/components/common/EmptyState";

const ALLOWED_TYPES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
};

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString();
}

const STATUS_BADGE_CLASSES = {
  SUBMITTED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SHORTLISTED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function VendorOpeningDetail({ openingId }) {
  const dispatch = useDispatch();
  const { currentOpening, detailsLoading, uploading, error } = useSelector(
    (state) => state.vendorOpenings
  );
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  useEffect(() => {
    dispatch(fetchVendorOpeningDetails(openingId));
  }, [dispatch, openingId]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const onDrop = useCallback(
    async (acceptedFiles, fileRejections) => {
      if (fileRejections.length > 0) {
        toast.error("Only PDF and PPTX files are supported.");
      }
      if (acceptedFiles.length === 0) return;

      try {
        const filenames = acceptedFiles.map((f) => f.name);
        const tokensResult = await dispatch(
          presignProfiles({ openingId, filenames })
        ).unwrap();

        await dispatch(
          uploadProfiles({ openingId, files: acceptedFiles, tokens: tokensResult })
        ).unwrap();

        toast.success(`${acceptedFiles.length} profile(s) submitted for review.`);
      } catch (err) {
        toast.error(typeof err === "string" ? err : "Upload failed");
      }
    },
    [dispatch, openingId]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ALLOWED_TYPES,
    multiple: true,
    disabled: uploading,
  });

  const handleDelete = async (profileId) => {
    setPendingDeleteId(profileId);
    try {
      await dispatch(deleteVendorProfile({ openingId, profileId })).unwrap();
      toast.success("Profile deleted");
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Failed to delete profile");
    } finally {
      setPendingDeleteId(null);
    }
  };

  if (detailsLoading && !currentOpening) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!currentOpening) {
    return <EmptyState title="Opening not found" message="This opening may have been closed or removed." />;
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{currentOpening.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{currentOpening.description}</p>
        <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
          <span>📍 {currentOpening.location || "Remote"}</span>
          <span>📄 {currentOpening.contractType || "-"}</span>
          <span>
            🧑‍💼 {currentOpening.hiringManagerName}
          </span>
          <span>
            ⏳ {currentOpening.experienceRange.min}
            {currentOpening.experienceRange.max != null ? `-${currentOpening.experienceRange.max}` : "+"} yrs
          </span>
          <span>👥 {currentOpening.profilesCount} profile(s) submitted</span>
        </div>
        {currentOpening.requiredSkills?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {currentOpening.requiredSkills.map((skill) => (
              <span
                key={skill}
                className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground"
              >
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        {...getRootProps()}
        className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-primary bg-primary/5" : "border-border"
        } ${uploading ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-2 text-sm text-foreground">
          {isDragActive ? "Drop the files here…" : "Drag & drop candidate profiles here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">PDF or PPTX only, multiple files supported</p>
        {uploading && (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-primary">
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Your Submitted Profiles</h2>
        {currentOpening.uploadedProfiles.length === 0 ? (
          <EmptyState title="No profiles yet" message="Upload a candidate's resume above to get started." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {currentOpening.uploadedProfiles.map((profile) => (
              <li key={profile.id} className="flex items-center justify-between p-3 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{profile.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      Submitted {formatDate(profile.submittedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${STATUS_BADGE_CLASSES[profile.status] || ""}`}
                  >
                    {profile.status}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      window.open(
                        `${process.env.NEXT_PUBLIC_BACKEND_URL}/vendor/profiles/${profile.id}/preview`,
                        "_blank"
                      )
                    }
                    aria-label="Preview profile"
                  >
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pendingDeleteId === profile.id}
                    onClick={() => handleDelete(profile.id)}
                    aria-label="Delete profile"
                  >
                    {pendingDeleteId === profile.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
