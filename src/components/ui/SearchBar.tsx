import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { XCircle, Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search...",
}) => {
  return (
    <div className="tw-relative">
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tw-px-8" // Left padding for search icon, right for clear button
      />
      <Search className="tw-pointer-events-none tw-absolute tw-left-2.5 tw-top-1/2 tw-size-3.5 -tw-translate-y-1/2 tw-transform tw-text-faint" />
      {value && (
        <Button
          variant={"ghost2"}
          onClick={() => onChange("")}
          className="tw-absolute tw-right-1.5 tw-top-1/2 tw-size-5 -tw-translate-y-1/2 tw-transform tw-rounded-full tw-p-0 tw-transition-colors"
          aria-label="Clear search"
        >
          <XCircle className="tw-size-3.5 tw-text-faint hover:tw-text-muted" />
        </Button>
      )}
    </div>
  );
};
