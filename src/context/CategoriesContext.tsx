'use client'
import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import type { CategoryRecord } from '@/types'
import { cacheCategories, getCachedCategories } from '@/lib/local-store'

interface CreateCategoryInput {
  label: string
  color: string
}

interface UpdateCategoryInput {
  label?: string
  color?: string
}

interface CategoriesContextType {
  categories: CategoryRecord[]
  byName: Record<string, CategoryRecord>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createCategory: (input: CreateCategoryInput) => Promise<{ ok: boolean; error?: string }>
  updateCategory: (id: string, input: UpdateCategoryInput) => Promise<{ ok: boolean; error?: string }>
  deleteCategory: (id: string) => Promise<{ ok: boolean; error?: string; sessionCount?: number }>
}

const CategoriesContext = createContext<CategoriesContextType>({
  categories: [],
  byName: {},
  loading: true,
  error: null,
  refresh: async () => {},
  createCategory: async () => ({ ok: false }),
  updateCategory: async () => ({ ok: false }),
  deleteCategory: async () => ({ ok: false }),
})

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<CategoryRecord[]>(() => {
    // Seed from cache immediately so UI is never empty
    return getCachedCategories<CategoryRecord>() ?? []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const byName = useMemo(() => {
    const map: Record<string, CategoryRecord> = {}
    for (const c of categories) map[c.name] = c
    return map
  }, [categories])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/categories')
      if (!res.ok) throw new Error('Failed to fetch categories')
      const data = await res.json()
      setCategories(data)
      cacheCategories(data)
      setError(null)
    } catch {
      // Offline or server error — fall back to cached data
      const cached = getCachedCategories<CategoryRecord>()
      if (cached && cached.length > 0) {
        setCategories(cached)
        setError(null)
      } else {
        setError('Failed to load categories')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const createCategory = useCallback(async (input: CreateCategoryInput) => {
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error ?? 'Failed to create category' }
      await refresh()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Failed to create category' }
    }
  }, [refresh])

  const updateCategory = useCallback(async (id: string, input: UpdateCategoryInput) => {
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error ?? 'Failed to update category' }
      await refresh()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Failed to update category' }
    }
  }, [refresh])

  const deleteCategory = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error ?? 'Failed to delete category', sessionCount: data.sessionCount }
      await refresh()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Failed to delete category' }
    }
  }, [refresh])

  return (
    <CategoriesContext.Provider value={{ categories, byName, loading, error, refresh, createCategory, updateCategory, deleteCategory }}>
      {children}
    </CategoriesContext.Provider>
  )
}

export function useCategories() {
  return useContext(CategoriesContext)
}
