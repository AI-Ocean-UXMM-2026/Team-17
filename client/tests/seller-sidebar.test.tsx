import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SellerSidebar } from "@/features/seller/components/seller-sidebar";
import { useAuthStore } from "@/stores/auth.store";
import { operatorNavigation } from "@/features/operator/config/operator-navigation";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/seller" } }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  pathname.current = "/seller";
  useAuthStore.setState({ user: null, status: "loading", revision: 0 });
});

it("shows the logo brand, workspace, and both nav sections", () => {
  render(<SellerSidebar />);
  expect(screen.getByLabelText("SURFERTrack")).toBeTruthy();
  expect(screen.getByText("Seller workspace")).toBeTruthy();
  expect(screen.getByText("Operations")).toBeTruthy();
  expect(screen.getByText("Delivery")).toBeTruthy();
  expect(screen.getByText(/Demo data only/)).toBeTruthy();
});

it("marks the current route as the active item", () => {
  pathname.current = "/seller/all-parcels";
  render(<SellerSidebar />);
  expect(screen.getByRole("link", { name: "Parcels" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Tracking" }).getAttribute("aria-current")).toBeNull();
});

it("marks tracking as active only on the tracking route", () => {
  pathname.current = "/seller/tracking";
  render(<SellerSidebar />);
  expect(screen.getByRole("link", { name: "Tracking" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Parcels" }).getAttribute("aria-current")).toBeNull();
});

it("keeps unavailable items non-interactive instead of linking to missing routes", () => {
  render(<SellerSidebar />);
  expect(screen.queryByRole("link", { name: /Dispatch/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Reports/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Delivery Team/ })).toBeNull();
  for (const label of ["Reports", "Delivery Team"]) {
    expect(screen.getByText(label).closest('[aria-disabled="true"]')).toBeTruthy();
  }
});

it("keeps dispatch in Operator navigation rather than the Seller workspace", () => {
  render(<SellerSidebar />);
  expect(screen.queryByText("Dispatch")).toBeNull();
  expect(screen.queryByRole("link", { name: "Rider Assignment" })).toBeNull();
  for (const link of screen.getAllByRole("link")) {
    expect(link.getAttribute("href")).not.toMatch(/^\/operator(?:\/|$)/);
  }
  expect(operatorNavigation.find((item) => item.title === "Rider Assignment")?.href).toBe("/operator/assignments");
});

it("provides a logout action in the sidebar footer", () => {
  render(<SellerSidebar />);
  expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
});
