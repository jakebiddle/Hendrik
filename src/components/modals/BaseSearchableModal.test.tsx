import {
  SearchableItemView,
  SearchableModalContent,
} from "@/components/modals/BaseSearchableModal";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

interface TestItem {
  id: string;
  label: string;
}

const TEST_ITEMS: SearchableItemView<TestItem>[] = [
  {
    raw: { id: "1", label: "Alpha" },
    key: "1",
    label: "Alpha",
    description: "First",
    searchText: "alpha first",
  },
  {
    raw: { id: "2", label: "Beta" },
    key: "2",
    label: "Beta",
    description: "Second",
    searchText: "beta second",
  },
];

describe("SearchableModalContent", () => {
  test("filters results by query", () => {
    render(
      <SearchableModalContent
        items={TEST_ITEMS}
        placeholder="Search test items"
        emptyMessage="No matches"
        onChoose={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search test items"), {
      target: { value: "beta" },
    });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).not.toBeNull();
  });

  test("selects active item with Enter", () => {
    const onChoose = jest.fn();

    render(
      <SearchableModalContent
        items={TEST_ITEMS}
        placeholder="Search test items"
        emptyMessage="No matches"
        onChoose={onChoose}
        onCancel={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search test items"), {
      target: { value: "beta" },
    });

    fireEvent.keyDown(screen.getByPlaceholderText("Search test items"), {
      key: "Enter",
    });

    expect(onChoose).toHaveBeenCalledWith({ id: "2", label: "Beta" });
  });

  test("calls cancel on Escape", () => {
    const onCancel = jest.fn();

    render(
      <SearchableModalContent
        items={TEST_ITEMS}
        placeholder="Search test items"
        emptyMessage="No matches"
        onChoose={jest.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(screen.getByPlaceholderText("Search test items"), {
      key: "Escape",
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
