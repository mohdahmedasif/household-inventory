import { useMemo, useState, type ReactNode } from "react";
import {
  AppstoreOutlined,
  BarChartOutlined,
  EllipsisOutlined,
  ImportOutlined,
  PlusOutlined,
  SettingOutlined,
  TableOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Layout } from "antd";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PAGE_ACTIONS_ID, type LayoutContext, type PageTitleOverride } from "./PageActions";

const { Sider, Content } = Layout;

type NavItem = { path: string; icon: ReactNode; label: string };

const PRIMARY_NAV: NavItem[] = [
  { path: "/", icon: <AppstoreOutlined />, label: "Pantry" },
  { path: "/stats", icon: <BarChartOutlined />, label: "Overview" },
  { path: "/reports", icon: <TableOutlined />, label: "Reports" },
];

const SECONDARY_NAV: NavItem[] = [
  { path: "/catalog", icon: <TagsOutlined />, label: "Catalog" },
  { path: "/import", icon: <ImportOutlined />, label: "Import" },
  { path: "/settings", icon: <SettingOutlined />, label: "Settings" },
];

const HEADINGS: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "Inventory", title: "Pantry" },
  "/products/new": { eyebrow: "Inventory", title: "Add product" },
  "/stats": { eyebrow: "Insights", title: "Overview" },
  "/reports": { eyebrow: "Insights", title: "Reports" },
  "/catalog": { eyebrow: "Setup", title: "Catalog" },
  "/import": { eyebrow: "Data", title: "Import" },
  "/settings": { eyebrow: "Preferences", title: "Settings" },
};

function heading(pathname: string) {
  if (HEADINGS[pathname]) return HEADINGS[pathname];
  if (pathname.startsWith("/products/") || pathname.startsWith("/items/")) {
    return { eyebrow: "Product", title: "Product details" };
  }
  return HEADINGS["/"];
}

function isActive(pathname: string, path: string): boolean {
  if (path === "/") {
    return pathname === "/" || (pathname.startsWith("/products/") && pathname !== "/products/new") || pathname.startsWith("/items/");
  }
  return pathname.startsWith(path);
}

function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="brand">
      <img className="brand-mark" src="/logo.svg" alt="" />
      <span className="brand-text">
        <span>Household inventory</span>
        <strong>Stocked</strong>
      </span>
    </Link>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [titleOverride, setTitleOverride] = useState<PageTitleOverride>(null);
  const outletContext = useMemo<LayoutContext>(() => ({ setTitleOverride }), []);
  const base = heading(pathname);
  const eyebrow = base.eyebrow;
  const title = titleOverride?.path === pathname ? titleOverride.title : base.title;
  const secondaryActive = SECONDARY_NAV.some((item) => isActive(pathname, item.path));

  const navLink = (item: NavItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      className={() => `nav-link${isActive(pathname, item.path) ? " active" : ""}`}
    >
      {item.icon}
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <Layout className="app-shell">
      <Sider className="sidebar" width={248} theme="light">
        <Brand />
        <Button
          className="sidebar-add"
          type="primary"
          size="large"
          block
          icon={<PlusOutlined />}
          onClick={() => navigate("/products/new")}
        >
          Add product
        </Button>
        <nav className="nav-section">
          <div className="nav-section-label">Inventory</div>
          {PRIMARY_NAV.map(navLink)}
        </nav>
        <nav className="nav-section sidebar-footer">
          <div className="nav-section-label">Setup</div>
          {SECONDARY_NAV.map(navLink)}
        </nav>
      </Sider>

      <Layout className="app-main">
        <header className="mobile-topbar">
          <Brand />
        </header>

        <Content className={`app-content${pathname.startsWith("/reports") ? " wide" : ""}`}>
          <div className="page-header">
            <div>
              <div className="page-eyebrow">{eyebrow}</div>
              <h1 className="page-heading">{title}</h1>
            </div>
            <div className="page-actions" id={PAGE_ACTIONS_ID} />
          </div>
          <Outlet context={outletContext} />
        </Content>
      </Layout>

      <nav className="tab-bar" aria-label="Main">
        {PRIMARY_NAV.slice(0, 2).map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`tab-item${isActive(pathname, item.path) ? " active" : ""}`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
        <div className="tab-add">
          <button type="button" aria-label="Add product" onClick={() => navigate("/products/new")}>
            <PlusOutlined />
          </button>
        </div>
        <Link
          to="/reports"
          className={`tab-item${isActive(pathname, "/reports") ? " active" : ""}`}
        >
          <TableOutlined />
          Reports
        </Link>
        <button
          type="button"
          className={`tab-item${secondaryActive ? " active" : ""}`}
          onClick={() => setMoreOpen(true)}
        >
          <EllipsisOutlined />
          More
        </button>
      </nav>

      <Drawer
        className="more-sheet"
        placement="bottom"
        height="auto"
        title="More"
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
      >
        {SECONDARY_NAV.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`more-link${isActive(pathname, item.path) ? " active" : ""}`}
            onClick={() => setMoreOpen(false)}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </Drawer>
    </Layout>
  );
}
