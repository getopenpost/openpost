"use client";

import { docsPath } from "@openpost/social-images";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { Check, Copy, LinkIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";

type CopyProps = {
  getText: () => string | Promise<string>;
  label: string;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
};

function DocumentationCopyButton({ getText, label, children, className, icon }: CopyProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionId = useId();
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (busy) return;
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
    setFailed(false);
    setBusy(true);
    setText("");
    try {
      const value = getText();
      const source = Promise.resolve(value).then((content) => {
        setText(content);
        return content;
      });
      // Keep async page fetches inside the click's clipboard admission.
      const write =
        typeof value !== "string" && navigator.clipboard && typeof ClipboardItem !== "undefined"
          ? navigator.clipboard.write([new ClipboardItem({ "text/plain": source })])
          : source.then((content) => navigator.clipboard.writeText(content));
      await Promise.all([source, write]);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={failed} onOpenChange={setFailed}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            void copy();
          }}
          aria-disabled={busy}
          aria-label={copied ? "Copied Text" : label}
          aria-describedby={failed ? descriptionId : undefined}
          className={`${className ?? buttonVariants({ size: "icon-xs" })} [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11`}
        >
          {copied ? <Check /> : (icon ?? <Copy />)}
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(320px,calc(100vw-32px))] space-y-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p id={descriptionId} role="alert" className="text-sm">
          Could not copy. Select the text and copy it manually, or retry.
        </p>
        {text && (
          <textarea
            aria-label="Text to copy"
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-24 w-full resize-y rounded border bg-fd-background p-2 text-sm"
          />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void copy()}
          className={buttonVariants({
            size: "sm",
            color: "secondary",
            className: "[@media(pointer:coarse)]:min-h-11",
          })}
        >
          Retry copy
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function DocumentationPre({
  allowCopy,
  ...props
}: ComponentProps<"pre"> & Pick<ComponentProps<typeof CodeBlock>, "allowCopy">) {
  const ref = useRef<HTMLElement>(null);
  return (
    <CodeBlock
      {...props}
      ref={ref}
      allowCopy={false}
      Actions={({ className }) => (
        <div className={className}>
          {allowCopy !== false && allowCopy !== "false" && (
            <DocumentationCopyButton
              label="Copy Text"
              getText={() => {
                const pre = ref.current?.querySelector("pre");
                if (!pre) throw new Error("Code is unavailable");
                const clone = pre.cloneNode(true) as HTMLPreElement;
                clone.querySelectorAll(".nd-copy-ignore").forEach((node) => node.replaceWith("\n"));
                return clone.textContent ?? "";
              }}
            />
          )}
        </div>
      )}
    >
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
}

type HeadingProps = ComponentProps<"h1"> & { as: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" };
export function DocumentationHeading({ as: Heading, children, className, ...props }: HeadingProps) {
  if (!props.id)
    return (
      <Heading {...props} className={className}>
        {children}
      </Heading>
    );
  return (
    <Heading
      {...props}
      className={`group/heading flex scroll-m-28 flex-row items-center gap-1 ${className ?? ""}`}
    >
      <a data-card="" href={`#${props.id}`}>
        {children}
      </a>
      <DocumentationCopyButton
        label="Copy Anchor Link"
        icon={<LinkIcon />}
        className={buttonVariants({
          variant: "ghost",
          size: "icon-xs",
          className:
            "not-prose shrink-0 text-fd-muted-foreground opacity-0 transition-opacity group-hover/heading:opacity-100 focus-visible:opacity-100",
        })}
        getText={() => {
          const url = new URL(window.location.href);
          url.hash = props.id!;
          return url.href;
        }}
      />
    </Heading>
  );
}

const markdownCache = new Map<string, Promise<string>>();
export function DocumentationMarkdownCopyButton({
  markdownUrl,
  children,
}: {
  markdownUrl: string;
  children: ReactNode;
}) {
  return (
    <DocumentationCopyButton
      label="Copy page"
      className={buttonVariants({
        color: "secondary",
        size: "sm",
        className: "gap-2 [&_svg]:size-3.5 [&_svg]:text-fd-muted-foreground",
      })}
      getText={() => {
        let content = markdownCache.get(markdownUrl);
        if (!content) {
          content = fetch(docsPath(markdownUrl))
            .then((response) => {
              if (!response.ok) throw new Error("Page text is unavailable");
              return response.text();
            })
            .catch((error) => {
              markdownCache.delete(markdownUrl);
              throw error;
            });
          markdownCache.set(markdownUrl, content);
        }
        return content;
      }}
    >
      {children}
    </DocumentationCopyButton>
  );
}
