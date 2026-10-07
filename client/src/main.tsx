import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "antd/dist/reset.css";
import "./index.css";

const INK = "#1c1917";
const MUTED = "#78716c";
const PRIMARY = "#3d6b4f";
const PRIMARY_DEEP = "#2f543d";
const SURFACE = "#ffffff";
const SUNKEN = "#f0ece5";
const BORDER = "#e7e2d8";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: PRIMARY,
          colorPrimaryHover: "#4a7d5d",
          colorPrimaryActive: PRIMARY_DEEP,
          colorInfo: PRIMARY,
          colorSuccess: PRIMARY,
          colorWarning: "#b45309",
          colorError: "#b42318",
          colorLink: PRIMARY_DEEP,
          colorText: INK,
          colorTextSecondary: MUTED,
          colorTextTertiary: "#a8a29e",
          colorBgLayout: "#f6f4ef",
          colorBgContainer: SURFACE,
          colorBgElevated: SURFACE,
          colorBorder: BORDER,
          colorBorderSecondary: "#ebe7df",
          colorFillAlter: SUNKEN,
          borderRadius: 12,
          borderRadiusLG: 16,
          borderRadiusSM: 10,
          controlHeight: 40,
          controlHeightLG: 44,
          fontSize: 15,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: "0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px rgba(28, 25, 23, 0.04)",
          boxShadowSecondary: "0 12px 28px rgba(28, 25, 23, 0.08)",
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
            hoverBorderColor: "#d9d2c5",
            activeBorderColor: PRIMARY,
            activeShadow: "0 0 0 3px rgba(61, 107, 79, 0.14)",
          },
          InputNumber: {
            borderRadius: 12,
            colorBgContainer: SURFACE,
            hoverBorderColor: "#d9d2c5",
            activeBorderColor: PRIMARY,
            activeShadow: "0 0 0 3px rgba(61, 107, 79, 0.14)",
          },
          Select: {
            borderRadius: 12,
            colorBgContainer: SURFACE,
            optionSelectedBg: "#e8f0ea",
            optionActiveBg: "rgba(61, 107, 79, 0.08)",
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
            headerSortActiveBg: "#ebe7df",
            headerSortHoverBg: "#ebe7df",
            rowHoverBg: "rgba(61, 107, 79, 0.05)",
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
            itemActiveBg: "#e8f0ea",
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
