import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "@/utils/Axios/AxiosInstance";

export const fetchVendorOpenings = createAsyncThunk(
  "vendorOpenings/fetchOpenings",
  async ({ page = 1, pageSize = 10 } = {}, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get("/vendor/openings", {
        params: { page, pageSize },
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to load openings");
    }
  }
);

export const fetchVendorOpeningDetails = createAsyncThunk(
  "vendorOpenings/fetchOpeningDetails",
  async (openingId, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get(`/vendor/openings/${openingId}`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to load opening details");
    }
  }
);

export const presignProfiles = createAsyncThunk(
  "vendorOpenings/presignProfiles",
  async ({ openingId, filenames }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post(`/vendor/openings/${openingId}/profiles/presign`, {
        filenames,
      });
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to presign uploads");
    }
  }
);

export const uploadProfiles = createAsyncThunk(
  "vendorOpenings/uploadProfiles",
  async ({ openingId, files, tokens }, { rejectWithValue, dispatch }) => {
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append(
        "uploadTokens",
        JSON.stringify(tokens.map((t) => ({ filename: t.filename, uploadToken: t.uploadToken })))
      );

      const response = await axiosInstance.post(
        `/vendor/openings/${openingId}/profiles/upload`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      // Refresh the opening details so the newly submitted profiles show up.
      dispatch(fetchVendorOpeningDetails(openingId));
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to upload profiles");
    }
  }
);

export const deleteVendorProfile = createAsyncThunk(
  "vendorOpenings/deleteProfile",
  async ({ openingId, profileId }, { rejectWithValue, dispatch }) => {
    try {
      await axiosInstance.delete(`/vendor/profiles/${profileId}`);
      dispatch(fetchVendorOpeningDetails(openingId));
      return profileId;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to delete profile");
    }
  }
);

const initialState = {
  openings: [],
  pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  currentOpening: null,
  loading: false,
  detailsLoading: false,
  uploading: false,
  error: null,
};

const vendorOpeningsSlice = createSlice({
  name: "vendorOpenings",
  initialState,
  reducers: {
    clearVendorOpeningsError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchVendorOpenings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchVendorOpenings.fulfilled, (state, action) => {
        state.loading = false;
        state.openings = action.payload.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchVendorOpenings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(fetchVendorOpeningDetails.pending, (state) => {
        state.detailsLoading = true;
        state.error = null;
      })
      .addCase(fetchVendorOpeningDetails.fulfilled, (state, action) => {
        state.detailsLoading = false;
        state.currentOpening = action.payload;
      })
      .addCase(fetchVendorOpeningDetails.rejected, (state, action) => {
        state.detailsLoading = false;
        state.error = action.payload;
      })

      .addCase(uploadProfiles.pending, (state) => {
        state.uploading = true;
        state.error = null;
      })
      .addCase(uploadProfiles.fulfilled, (state) => {
        state.uploading = false;
      })
      .addCase(uploadProfiles.rejected, (state, action) => {
        state.uploading = false;
        state.error = action.payload;
      })

      .addCase(deleteVendorProfile.rejected, (state, action) => {
        state.error = action.payload;
      });
  },
});

export const { clearVendorOpeningsError } = vendorOpeningsSlice.actions;
export default vendorOpeningsSlice.reducer;
