import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/redux/features/Auth/authSlice";
import vendorOpeningsReducer from "@/redux/features/Vendor/vendorOpeningsSlice";
import hiringManagerReducer from "@/redux/features/HiringManager/hiringManagerSlice";

const store = configureStore({
  reducer: {
    auth: authReducer,
    vendorOpenings: vendorOpeningsReducer,
    hiringManager: hiringManagerReducer,
  },
});

export default store;
