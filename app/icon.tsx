import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#55c8da",
          color: "#111d3a",
          display: "flex",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 132,
          fontWeight: 900,
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        P
      </div>
    ),
    size
  );
}
