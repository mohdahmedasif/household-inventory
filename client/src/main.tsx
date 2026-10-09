import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import { BrowserRouter } from "react-router-dom";
import "antd/dist/reset.css";
import "./index.css";
import App from "./App";
import { tint, token } from "./theme";

const INK = token("ink");
const MUTED = token("muted");
const PRIMARY = token("primary");
const PRIMARY_DEEP = token("primary-deep");
const PRIMARY_SOFT = token("primary-soft");
const SURFACE = token("surface");
const SUNKEN = token("sunken");
const BORDER = token("border");
const BORDER_STRONG = token("border-strong");
const BG_DEEP = token("bg-deep");
const FOCUS_RING = `0 0 0 3px ${tint("primary", 14)}`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: PRIMARY,
          colorPrimaryHover: token("primary-hover"),
          colorPrimaryActive: PRIMARY_DEEP,
          colorInfo: PRIMARY,
          colorSuccess: PRIMARY,
          colorWarning: token("warn"),
          colorError: token("danger"),
          colorLink: PRIMARY_DEEP,
          colorText: INK,
          colorTextSecondary: MUTED,
          colorTextTertiary: token("faint"),
          colorBgLayout: token("bg"),
          colorBgContainer: SURFACE,
          colorBgElevated: SURFACE,
          colorBorder: BORDER,
          colorBorderSecondary: BG_DEEP,
          colorFillAlter: SUNKEN,
          borderRadius: 12,
          borderRadiusLG: 16,
          borderRadiusSM: 10,
          controlHeight: 40,
          controlHeightLG: 44,
          fontSize: 15,
          fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim(),
          boxShadow: "var(--pantry-shadow-sm)",
          boxShadowSecondary: "var(--pantry-shadow-md)",
        },
        components: {
          Button: {
            borderRadius: 12,
            borderRadiusLG: 12,
            borderRadiusSM: 10,
            fontWeight: 600,
            primaryShadow: "none",
            defaultShadow: "none",
            defaultBorderColor: BORDER,
            defaultBg: SURFACE,
          },
          Input: {
            borderRadius: 12,
            colorBgContainer: SURFACE,
            hoverBorderColor: BORDER_STRONG,
            activeBorderColor: PRIMARY,
            activeShadow: FOCUS_RING,
          },
          InputNumber: {
            borderRadius: 12,
            colorBgContainer: SURFACE,
            hoverBorderColor: BORDER_STRONG,
            activeBorderColor: PRIMARY,
            activeShadow: FOCUS_RING,
          },
          Select: {
            borderRadius: 12,
            colorBgContainer: SURFACE,
            optionSelectedBg: PRIMARY_SOFT,
            optionActiveBg: tint("primary", 8),
          },
          DatePicker: {
            borderRadius: 12,
            colorBgContainer: SURFACE,
          },
          Card: {
            borderRadiusLG: 16,
            headerFontSize: 18,
            headerFontSizeSM: 16,
            paddingLG: 22,
            colorBorderSecondary: BORDER,
          },
          Table: {
            headerBg: SUNKEN,
            headerColor: MUTED,
            headerSortActiveBg: BG_DEEP,
            headerSortHoverBg: BG_DEEP,
            rowHoverBg: tint("primary", 5),
            borderColor: BORDER,
            headerSplitColor: "transparent",
            headerBorderRadius: 0,
            cellPaddingBlockSM: 8,
            cellPaddingInlineSM: 12,
            cellPaddingBlock: 12,
            cellPaddingInline: 14,
            footerBg: SUNKEN,
          },
          Modal: {
            contentBg: SURFACE,
            headerBg: SURFACE,
            titleFontSize: 19,
            borderRadiusLG: 16,
          },
          Tabs: {
            itemSelectedColor: PRIMARY_DEEP,
            itemHoverColor: PRIMARY,
            inkBarColor: PRIMARY,
            titleFontSize: 15,
          },
          Segmented: {
            borderRadius: 12,
            itemSelectedBg: SURFACE,
            trackBg: SUNKEN,
            trackPadding: 4,
          },
          Drawer: {
            colorBgElevated: SURFACE,
          },
          Pagination: {
            borderRadius: 10,
            itemActiveBg: PRIMARY_SOFT,
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
