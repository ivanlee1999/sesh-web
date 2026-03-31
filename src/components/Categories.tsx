'use client'
import { useState } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { List, ListItem, Button, Chip } from 'konsta/react'
import { useCategories } from '@/context/CategoriesContext'
import { CATEGORY_PALETTE } from '@/lib/categories'

function CategoryForm({
  formLabel,
  setFormLabel,
  formColor,
  setFormColor,
  formError,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  formLabel: string
  setFormLabel: (v: string) => void
  formColor: string
  setFormColor: (v: string) => void
  formError: string | null
  onSubmit: () => void
  onCancel: () => void
  submitting: boolean
  submitLabel: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={formLabel}
        onChange={e => setFormLabel(e.target.value)}
        placeholder="Category name"
        maxLength={40}
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-black outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      />
      <div className="grid grid-cols-6 gap-2">
        {CATEGORY_PALETTE.map(c => (
          <button
            key={c}
            onClick={() => setFormColor(c)}
            className={`h-8 w-8 rounded-lg border-2 transition-all ${formColor === c ? 'border-black ring-2 ring-gray-300 dark:border-white dark:ring-gray-600' : 'border-transparent'}`}
            style={{ backgroundColor: c }}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
      {formError && (
        <p className="text-sm text-red-500 dark:text-red-400">{formError}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button outline rounded small onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button rounded small onClick={onSubmit} disabled={submitting}>
          <Check className="mr-1 h-3.5 w-3.5" />
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

export default function Categories() {
  const { categories, loading, createCategory, updateCategory, deleteCategory } = useCategories()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formLabel, setFormLabel] = useState('')
  const [formColor, setFormColor] = useState(CATEGORY_PALETTE[0])
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const startCreate = () => {
    setEditingId(null)
    setFormLabel('')
    setFormColor(CATEGORY_PALETTE[0])
    setFormError(null)
    setShowForm(true)
  }

  const startEdit = (cat: typeof categories[0]) => {
    setShowForm(false)
    setEditingId(cat.id)
    setFormLabel(cat.label)
    setFormColor(cat.color)
    setFormError(null)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormError(null)
  }

  const handleSubmit = async () => {
    if (!formLabel.trim()) {
      setFormError('Label is required')
      return
    }
    setSubmitting(true)
    setFormError(null)

    if (editingId) {
      const result = await updateCategory(editingId, { label: formLabel.trim(), color: formColor })
      if (!result.ok) {
        setFormError(result.error ?? 'Failed to update')
      } else {
        setEditingId(null)
      }
    } else {
      const result = await createCategory({ label: formLabel.trim(), color: formColor })
      if (!result.ok) {
        setFormError(result.error ?? 'Failed to create')
      } else {
        setShowForm(false)
        setFormLabel('')
      }
    }
    setSubmitting(false)
  }

  const handleDelete = async (id: string) => {
    setSubmitting(true)
    setDeleteError(null)
    const result = await deleteCategory(id)
    if (!result.ok) {
      const msg = result.sessionCount
        ? `Cannot delete: ${result.sessionCount} session${result.sessionCount !== 1 ? 's' : ''} use this category`
        : (result.error ?? 'Failed to delete')
      setDeleteError(msg)
    } else {
      setConfirmDeleteId(null)
    }
    setSubmitting(false)
  }

  return (
    <div className="px-4 pb-4 pt-16 md:pt-20">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-black dark:text-white">Categories</h1>
        {!showForm && !editingId && (
          <Button outline rounded small onClick={startCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <CategoryForm
            formLabel={formLabel}
            setFormLabel={setFormLabel}
            formColor={formColor}
            setFormColor={setFormColor}
            formError={formError}
            onSubmit={handleSubmit}
            onCancel={cancelForm}
            submitting={submitting}
            submitLabel="Add"
          />
        </div>
      )}

      {loading && categories.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          <p className="text-sm">Loading…</p>
        </div>
      )}

      {deleteError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {deleteError}
          <button
            onClick={() => setDeleteError(null)}
            className="ml-2 border-none bg-transparent text-sm text-red-600 underline dark:text-red-400"
          >
            Dismiss
          </button>
        </div>
      )}

      <List strong inset className="!my-0 !rounded-2xl">
        {categories.map(cat => {
          if (editingId === cat.id) {
            return (
              <ListItem
                key={cat.id}
                title={
                  <CategoryForm
                    formLabel={formLabel}
                    setFormLabel={setFormLabel}
                    formColor={formColor}
                    setFormColor={setFormColor}
                    formError={formError}
                    onSubmit={handleSubmit}
                    onCancel={cancelForm}
                    submitting={submitting}
                    submitLabel="Save"
                  />
                }
              />
            )
          }

          return (
            <ListItem
              key={cat.id}
              media={
                <div
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: cat.color }}
                />
              }
              title={
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-black dark:text-white">
                    {cat.label}
                  </span>
                  {cat.isDefault && (
                    <Chip className="!text-xs" outline>
                      default
                    </Chip>
                  )}
                </div>
              }
              after={
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    onClick={() => startEdit(cat)}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {confirmDeleteId === cat.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Delete?</span>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        disabled={submitting}
                        className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                        title="Confirm delete"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteId(null); setDeleteError(null) }}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:text-gray-600"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setDeleteError(null); setConfirmDeleteId(cat.id) }}
                      className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-900/20"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              }
            />
          )
        })}
      </List>
    </div>
  )
}
