import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { isPatientUser } from '../../utils/patientAuth';

interface ProtectedPatientRouteProps {
  children: React.ReactNode;
}

const ProtectedPatientRoute: React.FC<ProtectedPatientRouteProps> = ({ children }) => {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const authorized = await isPatientUser();
      setIsAuthorized(authorized);
      setIsChecking(false);
    };
    checkAuth();
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <Navigate to="/patient/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedPatientRoute;
