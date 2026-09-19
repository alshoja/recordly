import { defineStore } from 'pinia'
import { router } from '@/router'
import axiosInstance from '@/axiosInstance.interceptor'

const baseUrl = `${import.meta.env.VITE_API_URL}`

type UserRole = 'ADMIN' | 'USER'

interface AuthUser {
  id: number
  email: string
  firstName?: string
  lastName?: string
  role: UserRole
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: JSON.parse(localStorage.getItem('user') || 'null') as AuthUser | null,
    returnUrl: null as string | null
  }),
  actions: {
    async login(email: string, password: string) {
      const response = await axiosInstance.post(`${baseUrl}/auth/login`, { email, password })
      const { user, access_token } = response.data

      this.user = user
      localStorage.setItem('user', JSON.stringify(user))
      localStorage.setItem('token', access_token)
      router.push(this.returnUrl || '/dashboard/default')
    },
    async register(email: string, password: string, firstName: string, lastName: string) {
      const response = await axiosInstance.post(`${baseUrl}/auth/signup`, {
        email,
        password,
        firstName,
        lastName
      })
      // New accounts need administrator approval, so signup returns only a message.
      return response.data.message as string
    },
    logout() {
      this.user = null
      localStorage.removeItem('user')
      localStorage.removeItem('token')
      router.push('/auth/login')
    }
  }
})
