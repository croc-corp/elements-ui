import { PxSparkline } from "@/components/lumesec/px-sparkline";

const CELL = "border-b border-border px-1 py-2";
const HEADER = "border-b border-border px-1 py-2 text-left font-normal";
const NUMBER = "border-b border-border px-1 py-2 text-right font-mono text-[12.5px] tabular-nums";

export default function PxSparklineDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <table className="w-[min(380px,100%)] border-collapse text-[13.5px]">
        <tbody>
          <tr>
            <th scope="row" className={HEADER}>
              Requests
            </th>
            <td className={CELL}>
              <PxSparkline label="Requests" data={[31, 35, 33, 40, 38, 44, 47, 45, 52, 58]} />
            </td>
            <td className={NUMBER}>58k</td>
          </tr>
          <tr>
            <th scope="row" className={HEADER}>
              Errors
            </th>
            <td className={CELL}>
              <PxSparkline label="Errors" data={[9, 8, 9, 7, 6, 7, 5, 4, 4, 3]} color="success" />
            </td>
            <td className={NUMBER}>0.3%</td>
          </tr>
          <tr>
            <th scope="row" className={HEADER}>
              Latency
            </th>
            <td className={CELL}>
              <PxSparkline label="Latency" data={[180, 176, 190, 184, 200, 196, 210, 205, 214, 222]} unit=" ms" />
            </td>
            <td className={NUMBER}>222 ms</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
