import { ClipboardCopy } from "lucide-react";

export default function InputClipboardCopy({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <div
      className={"bg-dark-900 flex flex-row items-center rounded " + className}
    >
      <input
        className={"bg-dark-900 grow rounded p-2 " + className}
        value={value}
        type={"text"}
        readOnly={true}
        onClick={(event) => {
          const target = event.target as HTMLInputElement;
          target.select();
        }}
      />
      <button
        className={
          "bg-primary-900 hover:bg-primary-800 active:bg-primary-700 flex cursor-copy flex-row items-center rounded-r p-2"
        }
        data-tooltip-content={"Click to copy"}
        type={"button"}
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => null)
            .catch((error) => {
              console.error("Failed to copy", error);
            });
        }}
      >
        <ClipboardCopy /> Copy
      </button>
    </div>
  );
}
