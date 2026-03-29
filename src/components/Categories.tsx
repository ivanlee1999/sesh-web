'use client'
import { useState } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { useCategories } from '@/context/CategoriesContext'
import { CATEGORY_PALETTE } from '@/lib/categories'

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

  const renderColorGrid = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
      {CATEGORY_PALETTE.map(c => (
        <button
          key={c}
          onClick={() => setFormColor(c)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: formColor === c ? '2.5px solid var(--text-primary)' : '2px solid transparent',
            background: c,
            cursor: 'pointer',
            transition: 'border-color 0.15s ease, transform 0.1s ease',
            outline: 'none',
          }}
          aria-label={`Color ${c}`}
        />
      ))}
    </div>
  )

  const renderForm = () => (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-4">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="text"
          value={formLabel}
          onChange={e => setFormLabel(e.target.value)}
          placeholder="Category name"
          maxLength={40}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 15,
            outline: 'none',
          }}
        />
        {renderColorGrid()}
        {formError && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{formError}</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={cancelForm}
            className="ghost-button"
            style={{ padding: '8px 16px', fontSize: 14 }}
          >
            <X style={{ width: 14, height: 14 }} />
            Cancel
          </button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={handleSubmit}
            disabled={submitting}
            className="primary-pill"
            style={{ padding: '8px 20px', fontSize: 14, opacity: submitting ? 0.6 : 1 }}
          >
            <Check style={{ width: 14, height: 14 }} />
            {editingId ? 'Save' : 'Add'}
          </motion.button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="px-4 pt-16 md:pt-20 pb-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Categories</h1>
        {!showForm && !editingId && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={startCreate}
            className="ghost-button ghost-button--accent"
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            <Plus style={{ width: 14, height: 14 }} />
            Add
          </motion.button>
        )}
      </div>

      {showForm && renderForm()}

      {loading && categories.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">Loading…</p>
        </div>
      )}

      {deleteError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 mb-4 text-sm text-red-600 dark:text-red-400">
          {deleteError}
          <button
            onClick={() => setDeleteError(null)}
            style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'inherit' }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
        {categories.map(cat => {
          if (editingId === cat.id) {
            return (
              <div key={cat.id} className="p-4">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <input
                    type="text"
                    value={formLabel}
                    onChange={e => setFormLabel(e.target.value)}
                    placeholder="Category name"
                    maxLength={40}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: 15,
                      outline: 'none',
                    }}
                  />
                  {renderColorGrid()}
                  {formError && (
                    <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{formError}</p>
                  )}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={cancelForm}
                      className="ghost-button"
                      style={{ padding: '8px 16px', fontSize: 14 }}
                    >
                      <X style={{ width: 14, height: 14 }} />
                      Cancel
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="primary-pill"
                      style={{ padding: '8px 20px', fontSize: 14, opacity: submitting ? 0.6 : 1 }}
                    >
                      <Check style={{ width: 14, height: 14 }} />
                      Save
                    </motion.button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div key={cat.id} className="flex items-center gap-3 px-4 py-3">
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: cat.color,
                  flexShrink: 0,
                }}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {cat.label}
                </span>
                {cat.isDefault && (
                  <span className="text-xs text-gray-400 ml-2">default</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => startEdit(cat)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {confirmDeleteId === cat.id ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span className="text-xs text-gray-400">Delete?</span>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      disabled={submitting}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      title="Confirm delete"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setConfirmDeleteId(null); setDeleteError(null) }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                      title="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setDeleteError(null); setConfirmDeleteId(cat.id) }}
                    disabled={cat.isDefault}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={cat.isDefault ? 'Default categories cannot be deleted' : 'Delete'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
