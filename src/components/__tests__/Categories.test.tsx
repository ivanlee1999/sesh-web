import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockCreateCategory = vi.fn()
const mockUpdateCategory = vi.fn()
const mockDeleteCategory = vi.fn()

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'development', label: 'Development', color: '#3b82f6', sortOrder: 0, isDefault: true },
      { id: '2', name: 'learning', label: 'Learning', color: '#f59e0b', sortOrder: 1, isDefault: false },
    ],
    byName: {},
    loading: false,
    error: null,
    refresh: vi.fn(),
    createCategory: mockCreateCategory,
    updateCategory: mockUpdateCategory,
    deleteCategory: mockDeleteCategory,
  }),
}))

import Categories from '../Categories'

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateCategory.mockResolvedValue({ ok: true })
  mockUpdateCategory.mockResolvedValue({ ok: true })
  mockDeleteCategory.mockResolvedValue({ ok: true })
})

describe('Categories', () => {
  it('renders create form with swatches', () => {
    render(<Categories />)

    // Click the "Add" button to show the form
    const addButton = screen.getByText('Add')
    fireEvent.click(addButton)

    // Form should appear with color swatches
    const input = screen.getByPlaceholderText('Category name')
    expect(input).toBeTruthy()

    // Check that color swatch buttons exist (12 palette colors)
    const swatchButtons = screen.getAllByRole('button').filter(
      btn => btn.getAttribute('aria-label')?.startsWith('Color #')
    )
    expect(swatchButtons.length).toBe(12)
  })

  it('renders category list with labels', () => {
    render(<Categories />)

    expect(screen.getByText('Development')).toBeTruthy()
    expect(screen.getByText('Learning')).toBeTruthy()
  })

  it('shows default chip for default category', () => {
    render(<Categories />)

    expect(screen.getByText('default')).toBeTruthy()
  })

  it('switches into edit mode', () => {
    render(<Categories />)

    // Click edit button on first category
    const editButtons = screen.getAllByTitle('Edit')
    fireEvent.click(editButtons[0])

    // Should show the form with the category label pre-filled
    const input = screen.getByPlaceholderText('Category name')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('Development')

    // Should show Save button
    expect(screen.getByText('Save')).toBeTruthy()
  })

  it('shows delete protection error message from context', async () => {
    mockDeleteCategory.mockResolvedValue({ ok: false, error: 'Category is in use', sessionCount: 5 })

    render(<Categories />)

    // Click delete on the second category (non-default)
    const deleteButtons = screen.getAllByTitle('Delete')
    fireEvent.click(deleteButtons[1])

    // Confirm the delete
    const confirmButton = screen.getByTitle('Confirm delete')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText('Cannot delete: 5 sessions use this category')).toBeTruthy()
    })
  })

  it('creates a new category via form submission', async () => {
    render(<Categories />)

    // Open create form
    fireEvent.click(screen.getByText('Add'))

    // Fill in the name
    const input = screen.getByPlaceholderText('Category name')
    fireEvent.change(input, { target: { value: 'New Category' } })

    // Submit via Enter key
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockCreateCategory).toHaveBeenCalledWith({
        label: 'New Category',
        color: '#3b82f6',
      })
    })
  })
})
