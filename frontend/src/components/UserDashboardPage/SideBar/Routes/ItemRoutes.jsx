import {
  LogOut,
  Settings,
  CreditCard,
  Headset,
  Briefcase,
  Users,
} from "lucide-react";
import { MdDataUsage } from "react-icons/md";

// Role-based menu items
const getOverviewItemsByRole = (role) => {
  switch (role) {
    // For BUSINESS_USER role
    case "BUSINESS_USER":
      return [
        {
          title: "Digital",
          href: "/business-user/digital-initiative",
          icon: MdDataUsage,
        },
      ];

    // For IT_VENDOR
    case "IT_VENDOR":
      return [
        { title: "Openings", href: "/vendor/openings", icon: Briefcase },
        { title: "Payments", href: "/vendor/payments", icon: CreditCard },
      ];

    // For HIRING_MANAGER
    case "HIRING_MANAGER":
      return [
        { title: "My Openings", href: "/hiring-manager/openings", icon: Users },
      ];

    default:
      return [];
  }
};

// Role-based sidebar sections
export const getSidebarSectionsByRole = (role) => {
  const overviewItems = getOverviewItemsByRole(role);

  if (overviewItems.length === 0) {
    return [];
  }

  return [
    {
      title: "Overview",
      items: overviewItems,
    },
  ];
};

export const supportItem = {
  title: "Support",
  href: "/user/support",
  icon: Headset,
};

export const settingsItem = {
  title: "Settings",
  href: "/user/settings",
  icon: Settings,
};
export const signOutItem = { title: "Sign Out", href: "#", icon: LogOut };
