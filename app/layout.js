import "./globals.css";

export const metadata = {
  title: "Boko Inventory Planner",
  description: "Automated Shopify stock reorder recommendations and restock email digests.",
};

// Boko brand wordmark (same SVG as the audit apps)
function BokoLogo({ height = 40 }) {
  const width = Math.round(height * 2.811);
  return (
    <img src="">
    <svg height={height} width={width} viewBox="5750 -2679.9 12500 4447.2"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible", flexShrink: 0 }}
      aria-label="Boko Digital">
      <path fill="#110000" d="M7218.1-1163.5h-880.7v-1237.2c0-203.6-103-279.3-230-279.3H5750v1516.3l293.1,0.1H5750V302c0,809.2,657.3,1465.3,1468.1,1465.3s1468.1-656,1468.1-1465.3S8029-1163.5,7218.1-1163.5z M7218.2,1181.3c-486.5,0-880.8-393.6-880.8-879.3v-879.3h880.8c486.5,0,880.8,393.6,880.8,879.3C8099.1,787.5,7704.7,1181.3,7218.2,1181.3z"/>
      <path fill="#111213" d="M11286.9,302c0-485.6-394.3-879.3-880.8-879.3c-486.5,0-880.9,393.6-880.9,879.3s394.3,879.3,880.9,879.3C10892.6,1181.1,11286.9,787.5,11286.9,302z M11874.2,302c0,809.3-657.3,1465.3-1468.1,1465.3S8938,1111.2,8938,302c0-809.3,657.3-1465.3,1468.1-1465.3C11216.9-1163.5,11874.2-507.3,11874.2,302z"/>
      <path fill="#BFFC00" d="M13174.5,1181.1c-14.8,0-29.6-0.7-44.1-2.1l1927.5-1923.7l-415.3-414.4L12715.2,764.6c-1.4-14.5-2.1-29.2-2.1-44v-1884.1h-587.3V720.6c0,578.1,469.4,1046.7,1048.6,1046.7H15062v-586.2H13174.5L13174.5,1181.1z"/>
      <path fill="#111213" d="M17662.7,302c0-485.6-394.3-879.3-880.8-879.3s-880.9,393.6-880.9,879.3s394.5,879.3,880.9,879.3C17268.4,1181.3,17662.7,787.5,17662.7,302z M18250,302c0,809.3-657.3,1465.3-1468.1,1465.3c-810.9,0-1468.1-656.1-1468.1-1465.3c0-809.3,657.3-1465.3,1468.1-1465.3C17592.7-1163.5,18250-507.3,18250,302z"/>
    </svg>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header style={{
          background: "#fff", borderBottom: "1px solid #E5E7EB",
          padding: "10px 20px", display: "flex", alignItems: "center",
          justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20,
        }}>
          <a href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
            <BokoLogo height={40} />
          </a>
          <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a href="/dashboard" style={{
              background: "#BFFC00", color: "#0A0A0A", fontWeight: 800, fontSize: 13,
              letterSpacing: ".04em", textTransform: "uppercase", padding: "9px 16px",
              borderRadius: 10, textDecoration: "none", fontFamily: "'Poppins',system-ui,sans-serif",
            }}>Dashboard</a>
            <a href="/settings" style={{
              color: "#4B5563", fontWeight: 600, fontSize: 13, textDecoration: "none",
              padding: "9px 10px", borderRadius: 10, fontFamily: "'Poppins',system-ui,sans-serif",
            }}>Settings</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
