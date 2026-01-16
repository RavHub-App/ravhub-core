import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { CssVarsProvider, extendTheme } from '@mui/joy'
import Dashboard from './pages/Dashboard'
import Repos from './pages/Repos'
import AdminRepos from './pages/AdminRepos'
import RepoDetails from './pages/RepoDetails'
import CreateRepository from './pages/CreateRepository'
import Users from './pages/Users'
import Roles from './pages/Roles'
import Settings from './pages/Settings'
import Login from './pages/auth/Login'
import Bootstrap from './pages/auth/Bootstrap'
import MainLayout from './components/Layout/MainLayout'
import { AuthProvider } from './contexts/AuthContext'
import { NotificationProvider } from './components/NotificationSystem'
import AuthGuard from './components/AuthGuard'
import './App.css'

const theme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        // Full set of primary shades so components and CSS-vars keep consistent
        primary: {
          50: '#f3f5ff',
          100: '#e8edff',
          200: '#d0d8ff',
          300: '#aeb6ff',
          400: '#8093f4',
          500: '#566ACD',
          600: '#3f4db3',
          700: '#2e398f',
          800: '#222a6f',
          900: '#171d4f'
        },
        neutral: {
          plainColor: '#111827',
          softBg: '#f6f7fb',
          outlinedBorder: 'rgba(0,0,0,0.08)'
        }
      },
    },
  },
  components: {
    JoyList: {
      styleOverrides: {
        root: {
          '--ListItem-minHeight': '32px',
          '--ListItem-paddingY': '0px',
        }
      }
    },
    JoyListItemButton: {
      styleOverrides: {
        root: {
          minHeight: '32px',
        }
      }
    }
  }
})

function App() {
  return (
    <CssVarsProvider theme={theme}>
      <NotificationProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/auth/login" element={<Login />} />
              <Route path="/auth/bootstrap" element={<Bootstrap />} />


              <Route path="/" element={
                <AuthGuard>
                  <MainLayout>
                    <Dashboard />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="/repos" element={
                <AuthGuard>
                  <MainLayout>
                    <Repos />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="/admin/repos" element={
                <AuthGuard>
                  <MainLayout>
                    <AdminRepos />
                  </MainLayout>
                </AuthGuard>
              } />
              <Route path="/admin/repos/create" element={
                <AuthGuard>
                  <MainLayout>
                    <CreateRepository />
                  </MainLayout>
                </AuthGuard>
              } />
              <Route path="/admin/repos/:name" element={
                <AuthGuard>
                  <MainLayout>
                    <RepoDetails />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="/repos/:name" element={
                <AuthGuard>
                  <MainLayout>
                    <RepoDetails />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="/users" element={
                <AuthGuard>
                  <MainLayout>
                    <Users />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="/roles" element={
                <AuthGuard>
                  <MainLayout>
                    <Roles />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="/settings" element={
                <AuthGuard>
                  <MainLayout>
                    <Settings />
                  </MainLayout>
                </AuthGuard>
              } />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
    </CssVarsProvider>
  )
}

export default App
