import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "@/utils/Axios/AxiosInstance";

export const fetchHiringManagerOpenings = createAsyncThunk(
  "hiringManager/fetchOpenings",
  async ({ page = 1, pageSize = 10 } = {}, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get("/hiring-manager/openings", {
        params: { page, pageSize },
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to load openings");
    }
  }
);

export const fetchHiringManagerProfiles = createAsyncThunk(
  "hiringManager/fetchProfiles",
  async (openingId, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get(`/hiring-manager/openings/${openingId}/profiles`);
      return response.data.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to load profiles");
    }
  }
);

export const shortlistProfile = createAsyncThunk(
  "hiringManager/shortlistProfile",
  async (profileId, { rejectWithValue }) => {
    try {
      await axiosInstance.post(`/hiring-manager/profiles/${profileId}/shortlist`);
      return profileId;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to shortlist profile");
    }
  }
);

export const rejectProfile = createAsyncThunk(
  "hiringManager/rejectProfile",
  async (profileId, { rejectWithValue }) => {
    try {
      await axiosInstance.post(`/hiring-manager/profiles/${profileId}/reject`);
      return profileId;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || "Failed to reject profile");
    }
  }
);

const initialState = {
  openings: [],
  pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  profiles: [],
  profilesOpeningId: null,
  loading: false,
  profilesLoading: false,
  error: null,
};

const hiringManagerSlice = createSlice({
  name: "hiringManager",
  initialState,
  reducers: {
    clearHiringManagerError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHiringManagerOpenings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchHiringManagerOpenings.fulfilled, (state, action) => {
        state.loading = false;
        state.openings = action.payload.data;
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchHiringManagerOpenings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })

      .addCase(fetchHiringManagerProfiles.pending, (state) => {
        state.profilesLoading = true;
        state.error = null;
      })
      .addCase(fetchHiringManagerProfiles.fulfilled, (state, action) => {
        state.profilesLoading = false;
        state.profiles = action.payload;
      })
      .addCase(fetchHiringManagerProfiles.rejected, (state, action) => {
        state.profilesLoading = false;
        state.error = action.payload;
      })

      .addCase(shortlistProfile.fulfilled, (state, action) => {
        const profile = state.profiles.find((p) => p.id === action.payload);
        if (profile) profile.status = "SHORTLISTED";
      })
      .addCase(rejectProfile.fulfilled, (state, action) => {
        const profile = state.profiles.find((p) => p.id === action.payload);
        if (profile) profile.status = "REJECTED";
      });
  },
});

export const { clearHiringManagerError } = hiringManagerSlice.actions;
export default hiringManagerSlice.reducer;
