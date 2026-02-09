import { SearchBar } from "@/components/ui/SearchBar";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("SearchBar", () => {
  test("renders input with search placeholder and icon", () => {
    render(<SearchBar value="" onChange={jest.fn()} placeholder="Search projects..." />);

    const input = screen.getByPlaceholderText("Search projects...");
    expect(input).not.toBeNull();
  });

  test("hides clear button when value is empty", () => {
    render(<SearchBar value="" onChange={jest.fn()} />);

    expect(screen.queryByLabelText("Clear search")).toBeNull();
  });

  test("shows clear button when value is present", () => {
    render(<SearchBar value="abc" onChange={jest.fn()} />);

    expect(screen.queryByLabelText("Clear search")).not.toBeNull();
  });

  test("clears value when clear button is clicked", () => {
    const onChange = jest.fn();

    render(<SearchBar value="abc" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Clear search"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  test("applies effective input padding overrides for both empty and non-empty states", () => {
    const { rerender } = render(<SearchBar value="" onChange={jest.fn()} />);
    const inputWhenEmpty = screen.getByPlaceholderText("Search...") as HTMLInputElement;

    expect(inputWhenEmpty.className.includes("!tw-pl-8")).toBe(true);
    expect(inputWhenEmpty.className.includes("!tw-pr-3")).toBe(true);
    expect(inputWhenEmpty.className.includes("!tw-pr-8")).toBe(false);

    rerender(<SearchBar value="abc" onChange={jest.fn()} />);
    const inputWhenFilled = screen.getByPlaceholderText("Search...") as HTMLInputElement;

    expect(inputWhenFilled.className.includes("!tw-px-8")).toBe(true);
    expect(inputWhenFilled.className.includes("!tw-pr-3")).toBe(false);
  });
});
